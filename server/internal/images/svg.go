package images

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"
)

// MaxSVGBytes is the largest picture a pack may carry.
const MaxSVGBytes = 256 << 10

// maxSVGDepth bounds element nesting.
const maxSVGDepth = 64

const (
	svgNS         = "http://www.w3.org/2000/svg"
	xlinkNS       = "http://www.w3.org/1999/xlink"
	maxSVGUses    = 64
	maxSVGAttrLen = 64 << 10
)

// allowedElements is the drawing vocabulary of a picture: shapes, groups,
// gradients, clipping and masks. Anything that scripts, loads, animates or
// embeds another document (script, foreignObject, image, a, animate, set,
// animateTransform, style, iframe) is not in it, so a pack cannot carry active
// content into the page that inlines its pictures.
var allowedElements = setOf(
	"svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "clipPath", "mask", "use",
	"linearGradient", "radialGradient", "stop", "title", "desc",
)

// allowedAttrs is the attribute vocabulary, the same for every element: no
// event handler, no style (declarations are converted, see styleProps), no
// href (handled apart), nothing a browser reads as a URL except url(#id).
// apps/web/src/lib/api/svg.ts holds the same list; docs/contracts/images/
// README.md names it.
var allowedAttrs = setOf(
	"id", "class", "version", "viewBox", "preserveAspectRatio", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
	"fx", "fy", "fr", "x1", "y1", "x2", "y2", "d", "points", "transform", "pathLength", "offset",
	"gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits",
	"clip-path", "clip-rule", "mask", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap",
	"stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity",
	"color", "stop-color", "stop-opacity", "display", "visibility", "overflow", "vector-effect", "paint-order",
)

// styleProps are the declarations of a style attribute that are turned into
// the attribute of the same name (the style attribute itself is never kept).
var styleProps = setOf(
	"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
	"stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "stop-color",
	"stop-opacity", "display", "visibility", "clip-rule", "paint-order",
)

func setOf(names ...string) map[string]bool {
	m := make(map[string]bool, len(names))
	for _, n := range names {
		m[n] = true
	}
	return m
}

// urlRef finds url(...) references; only same-document ones (#id) pass.
var urlRef = regexp.MustCompile(`(?i)url\(\s*['"]?\s*([^'")\s]*)`)

var fragmentRef = regexp.MustCompile(`^#[A-Za-z0-9_.:-]+$`)

// svgNode is one element of the parsed picture, or a run of text.
type svgNode struct {
	name  string
	attrs [][2]string
	kids  []*svgNode
	text  string // only for a text node (name == "")
}

// CheckSVG validates one picture; see CanonicalSVG.
func CheckSVG(b []byte) error {
	_, err := CanonicalSVG(b)
	return err
}

// CanonicalSVG validates one picture and returns its canonical form, the only
// thing that is stored and served. The input must be at most MaxSVGBytes of
// well-formed UTF-8 XML whose root is an <svg> in the SVG namespace, made of
// allowedElements with allowedAttrs only. Refused: a comment, processing
// instruction (an XML header aside), DOCTYPE or entity; any on* attribute; a
// style element; a href that is not a plain #id; url() that is not #id; script,
// data or @import values; backslash escapes; duplicate ids or attributes; more
// than maxSVGUses <use>, a <use> of a <use> or of an element that holds one (so
// the cost cannot multiply); text anywhere but <title> and <desc>; content after
// the root. The canonical form is rebuilt from what was parsed: no comment, no
// header, one xmlns, double-quoted attributes in source order, escaped text,
// xlink:href written as href, style declarations written as attributes. It
// cannot re-parse as HTML into something else, whatever the pack's bytes were:
// that is the point (HTML's parser ends a comment at "<!-->" where XML does not).
func CanonicalSVG(b []byte) ([]byte, error) {
	if len(b) == 0 {
		return nil, errors.New("empty")
	}
	if len(b) > MaxSVGBytes {
		return nil, fmt.Errorf("%d bytes exceeds the %d byte limit", len(b), MaxSVGBytes)
	}
	if !utf8.Valid(b) {
		return nil, errors.New("not UTF-8")
	}
	d := xml.NewDecoder(bytes.NewReader(b))
	d.Strict = true
	d.Entity = nil // only the five predefined entities
	var root *svgNode
	var stack []*svgNode
	for {
		tok, err := d.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("not well-formed: %w", err)
		}
		switch t := tok.(type) {
		case xml.Directive:
			return nil, errors.New("a DOCTYPE or other directive is not allowed")
		case xml.Comment:
			return nil, errors.New("a comment is not allowed")
		case xml.ProcInst:
			if t.Target != "xml" || root != nil {
				return nil, fmt.Errorf("processing instruction <?%s?> is not allowed", t.Target)
			}
		case xml.StartElement:
			if len(stack) == 0 && root != nil {
				return nil, errors.New("content after the root element")
			}
			n, err := checkElement(t, len(stack) == 0)
			if err != nil {
				return nil, err
			}
			if len(stack) == 0 {
				root = n
			} else {
				p := stack[len(stack)-1]
				p.kids = append(p.kids, n)
			}
			stack = append(stack, n)
			if len(stack) > maxSVGDepth {
				return nil, fmt.Errorf("elements nested deeper than %d", maxSVGDepth)
			}
		case xml.EndElement:
			stack = stack[:len(stack)-1]
		case xml.CharData:
			if len(stack) == 0 {
				if len(bytes.TrimSpace(t)) > 0 {
					return nil, errors.New("text outside the root element")
				}
				continue
			}
			p := stack[len(stack)-1]
			if p.name == "title" || p.name == "desc" {
				p.kids = append(p.kids, &svgNode{text: strings.ReplaceAll(string(t), "\r", "")})
			} else if len(bytes.TrimSpace(t)) > 0 {
				return nil, fmt.Errorf("text inside <%s> is not allowed", p.name)
			}
		}
	}
	if root == nil {
		return nil, errors.New("no <svg> element")
	}
	if err := checkUses(root); err != nil {
		return nil, err
	}
	var out bytes.Buffer
	writeNode(&out, root, true)
	return out.Bytes(), nil
}

func checkElement(t xml.StartElement, isRoot bool) (*svgNode, error) {
	if isRoot && (t.Name.Local != "svg" || t.Name.Space != svgNS) {
		return nil, errors.New("the root element is not an <svg> in the SVG namespace")
	}
	if t.Name.Space != svgNS || !allowedElements[t.Name.Local] {
		return nil, fmt.Errorf("element <%s> is not allowed", t.Name.Local)
	}
	n := &svgNode{name: t.Name.Local}
	set := func(name, val string) {
		for i := range n.attrs {
			if n.attrs[i][0] == name {
				n.attrs[i][1] = val
				return
			}
		}
		n.attrs = append(n.attrs, [2]string{name, val})
	}
	seen := map[string]bool{}
	for _, a := range t.Attr {
		key := a.Name.Space + "|" + a.Name.Local
		if seen[key] {
			return nil, fmt.Errorf("attribute %s twice", a.Name.Local)
		}
		seen[key] = true
		switch {
		case a.Name.Space == "" && a.Name.Local == "xmlns":
			if a.Value != svgNS {
				return nil, fmt.Errorf("xmlns=%q is not the SVG namespace", a.Value)
			}
		case a.Name.Space == "xmlns":
			if a.Name.Local != "xlink" || a.Value != xlinkNS {
				return nil, fmt.Errorf("namespace declaration xmlns:%s is not allowed", a.Name.Local)
			}
		case a.Name.Local == "href" && (a.Name.Space == "" || a.Name.Space == xlinkNS):
			if n.name != "use" && n.name != "linearGradient" && n.name != "radialGradient" {
				return nil, fmt.Errorf("href on <%s> is not allowed", n.name)
			}
			if !fragmentRef.MatchString(a.Value) {
				return nil, fmt.Errorf("href=%q leaves the document", a.Value)
			}
			if _, dup := attrOf(n, "href"); dup {
				return nil, errors.New("href twice")
			}
			set("href", a.Value)
		case a.Name.Space == "" && a.Name.Local == "style":
			decls, err := parseStyle(a.Value)
			if err != nil {
				return nil, err
			}
			for _, kv := range decls {
				set(kv[0], kv[1])
			}
		case a.Name.Space == "" && allowedAttrs[a.Name.Local]:
			if err := checkValue(a.Name.Local, a.Value); err != nil {
				return nil, err
			}
			set(a.Name.Local, collapseSpace(a.Value))
		default:
			return nil, fmt.Errorf("attribute %s is not allowed", a.Name.Local)
		}
	}
	return n, nil
}

func attrOf(n *svgNode, name string) (string, bool) {
	for _, a := range n.attrs {
		if a[0] == name {
			return a[1], true
		}
	}
	return "", false
}

// collapseSpace is XML's attribute-value normalisation (tab, CR, LF to space),
// which a browser applies and the Go decoder does not.
func collapseSpace(v string) string {
	return strings.NewReplacer("\r\n", " ", "\t", " ", "\n", " ", "\r", " ").Replace(v)
}

func checkValue(name, val string) error {
	if len(val) > maxSVGAttrLen {
		return fmt.Errorf("attribute %s is too long", name)
	}
	lower := strings.ToLower(val)
	for _, bad := range []string{"\\", "/*", "javascript:", "data:", "@import", "expression(", "image-set", "src(", "<"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("attribute %s holds %q", name, bad)
		}
	}
	for _, r := range val {
		if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
			return fmt.Errorf("attribute %s holds a control character", name)
		}
	}
	for _, m := range urlRef.FindAllStringSubmatch(val, -1) {
		if !fragmentRef.MatchString(m[1]) {
			return fmt.Errorf("attribute %s references %q outside the document", name, m[1])
		}
	}
	if strings.Contains(lower, "url(") && name != "fill" && name != "stroke" && name != "clip-path" && name != "mask" {
		return fmt.Errorf("attribute %s may not hold url()", name)
	}
	return nil
}

// parseStyle turns "fill:#fff;stroke:none" into attribute pairs; any other
// property, !important or anything unusual refuses the picture.
func parseStyle(v string) ([][2]string, error) {
	var out [][2]string
	for _, decl := range strings.Split(v, ";") {
		decl = strings.TrimSpace(decl)
		if decl == "" {
			continue
		}
		k, val, ok := strings.Cut(decl, ":")
		k, val = strings.ToLower(strings.TrimSpace(k)), strings.TrimSpace(val)
		if !ok || !styleProps[k] || val == "" || strings.Contains(val, "!") {
			return nil, fmt.Errorf("style declaration %q is not allowed", decl)
		}
		if err := checkValue(k, val); err != nil {
			return nil, err
		}
		out = append(out, [2]string{k, collapseSpace(val)})
	}
	return out, nil
}

// checkUses bounds the cost of <use>: ids are unique, at most maxSVGUses
// <use>, and a <use> neither targets a <use> nor an element holding one.
func checkUses(root *svgNode) error {
	ids := map[string]*svgNode{}
	var uses []*svgNode
	var walk func(n *svgNode) error
	walk = func(n *svgNode) error {
		if n.name == "" {
			return nil
		}
		if id, ok := attrOf(n, "id"); ok {
			if ids[id] != nil {
				return fmt.Errorf("id %q twice", id)
			}
			ids[id] = n
		}
		if n.name == "use" {
			uses = append(uses, n)
		}
		for _, k := range n.kids {
			if err := walk(k); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(root); err != nil {
		return err
	}
	if len(uses) > maxSVGUses {
		return fmt.Errorf("more than %d <use> elements", maxSVGUses)
	}
	for _, u := range uses {
		href, _ := attrOf(u, "href")
		if t := ids[strings.TrimPrefix(href, "#")]; t != nil && holdsUse(t) {
			return fmt.Errorf("<use href=%q> reaches another <use>", href)
		}
	}
	return nil
}

func holdsUse(n *svgNode) bool {
	if n.name == "use" {
		return true
	}
	for _, k := range n.kids {
		if holdsUse(k) {
			return true
		}
	}
	return false
}

var attrEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
var textEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

func writeNode(w *bytes.Buffer, n *svgNode, root bool) {
	if n.name == "" {
		w.WriteString(textEscaper.Replace(n.text))
		return
	}
	w.WriteByte('<')
	w.WriteString(n.name)
	if root {
		w.WriteString(` xmlns="` + svgNS + `"`)
	}
	for _, a := range n.attrs {
		w.WriteString(" " + a[0] + `="` + attrEscaper.Replace(a[1]) + `"`)
	}
	if len(n.kids) == 0 {
		w.WriteString("/>")
		return
	}
	w.WriteByte('>')
	for _, k := range n.kids {
		writeNode(w, k, false)
	}
	w.WriteString("</" + n.name + ">")
}
