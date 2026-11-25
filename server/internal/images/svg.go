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

const svgNS = "http://www.w3.org/2000/svg"

// allowedElements is the drawing vocabulary of a picture: shapes, groups,
// gradients, clipping and masks. Anything that scripts, loads, animates or
// embeds another document (script, foreignObject, image, a, animate, set,
// style, iframe) is not in it, so a pack cannot carry active content into
// the page that inlines its pictures.
var allowedElements = map[string]bool{
	"svg": true, "g": true, "path": true, "circle": true, "ellipse": true, "rect": true, "line": true,
	"polyline": true, "polygon": true, "defs": true, "clipPath": true, "mask": true, "use": true,
	"linearGradient": true, "radialGradient": true, "stop": true, "title": true, "desc": true,
}

// urlRef finds url(...) references; only same-document ones (#id) pass.
var urlRef = regexp.MustCompile(`(?i)url\(\s*['"]?\s*([^'")\s]*)`)

// CheckSVG validates one picture: at most MaxSVGBytes of well-formed UTF-8 XML
// whose root is an <svg> in the SVG namespace, made of allowedElements only,
// with no DOCTYPE (no entities), no on* attribute, no reference that leaves
// the document (href/xlink:href must be #fragment, url() must be #fragment),
// no javascript: or data: value, and nothing after the root element. The
// pack's bytes are stored and served as they are; this is the gate.
func CheckSVG(b []byte) error {
	if len(b) == 0 {
		return errors.New("empty")
	}
	if len(b) > MaxSVGBytes {
		return fmt.Errorf("%d bytes exceeds the %d byte limit", len(b), MaxSVGBytes)
	}
	if !utf8.Valid(b) {
		return errors.New("not UTF-8")
	}
	d := xml.NewDecoder(bytes.NewReader(b))
	d.Strict = true
	d.Entity = nil // only the five predefined entities
	depth := 0
	seenRoot := false
	for {
		tok, err := d.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("not well-formed: %w", err)
		}
		switch t := tok.(type) {
		case xml.Directive:
			return errors.New("a DOCTYPE or other directive is not allowed")
		case xml.ProcInst:
			if t.Target != "xml" {
				return fmt.Errorf("processing instruction <?%s?> is not allowed", t.Target)
			}
		case xml.StartElement:
			if depth == 0 {
				if seenRoot {
					return errors.New("content after the root element")
				}
				seenRoot = true
				if t.Name.Local != "svg" || t.Name.Space != svgNS {
					return errors.New("the root element is not an <svg> in the SVG namespace")
				}
			}
			if t.Name.Space != svgNS || !allowedElements[t.Name.Local] {
				return fmt.Errorf("element <%s> is not allowed", t.Name.Local)
			}
			depth++
			if depth > maxSVGDepth {
				return fmt.Errorf("elements nested deeper than %d", maxSVGDepth)
			}
			for _, a := range t.Attr {
				if err := checkAttr(a); err != nil {
					return err
				}
			}
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && len(bytes.TrimSpace(t)) > 0 {
				return errors.New("text outside the root element")
			}
		}
	}
	if !seenRoot {
		return errors.New("no <svg> element")
	}
	return nil
}

func checkAttr(a xml.Attr) error {
	name := strings.ToLower(a.Name.Local)
	val := strings.TrimSpace(a.Value)
	lower := strings.ToLower(val)
	if strings.HasPrefix(name, "on") {
		return fmt.Errorf("attribute %s is not allowed", a.Name.Local)
	}
	if name == "href" { // href and xlink:href
		if !strings.HasPrefix(val, "#") {
			return fmt.Errorf("%s=%q leaves the document", a.Name.Local, val)
		}
		return nil
	}
	if strings.Contains(lower, "javascript:") || strings.Contains(lower, "data:") || strings.Contains(lower, "@import") || strings.Contains(lower, "expression(") {
		return fmt.Errorf("attribute %s holds a script or data URL", a.Name.Local)
	}
	for _, m := range urlRef.FindAllStringSubmatch(val, -1) {
		if !strings.HasPrefix(m[1], "#") {
			return fmt.Errorf("attribute %s references %q outside the document", a.Name.Local, m[1])
		}
	}
	return nil
}
