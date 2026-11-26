package images

import (
	"strings"
	"testing"
)

func TestCheckSVGAcceptsPlainDrawings(t *testing.T) {
	for name, svg := range map[string]string{
		"openmoji":                `<svg id="emoji" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg"><g id="line"><path fill="none" stroke="#000" stroke-width="2" d="M1 2h3"/><circle cx="1" cy="1" r="2"/></g></svg>`,
		"mulberry":                `<svg xmlns="http://www.w3.org/2000/svg" width="850.394" height="850.394" viewBox="0 0 850.394 850.394" overflow="visible"><path d="M0 0" fill="#abda4d"/><path class="aac-skin-fill" fill="#ffeec8" d="M1 1"/></svg>`,
		"xml header and gradient": `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="a"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#a)" width="1" height="1"/><use href="#a"/></svg>`,
		"style attribute":         `<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:#000;stroke:none" d="M0 0"/></svg>`,
	} {
		if err := CheckSVG([]byte(svg)); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestCheckSVGRefusesActiveContent(t *testing.T) {
	const open = `<svg xmlns="http://www.w3.org/2000/svg">`
	for name, svg := range map[string]string{
		"script":            open + `<script>alert(1)</script></svg>`,
		"foreignObject":     open + `<foreignObject><div/></foreignObject></svg>`,
		"event handler":     open + `<path onload="x()" d="M0 0"/></svg>`,
		"event handler any": open + `<g OnClick="x()"/></svg>`,
		"external href":     open + `<use href="https://example.test/x.svg#a"/></svg>`,
		"xlink data href":   `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="data:image/png;base64,AAAA"/></svg>`,
		"javascript url":    open + `<a href="javascript:alert(1)"/></svg>`,
		"external url()":    open + `<rect fill="url(https://example.test/a)"/></svg>`,
		"style element":     open + `<style>@import url(https://example.test/a.css)</style></svg>`,
		"style import":      open + `<rect style="background:url('//example.test/a')"/></svg>`,
		"animate":           open + `<animate attributeName="href" to="javascript:alert(1)"/></svg>`,
		"image element":     open + `<image href="#a"/></svg>`,
		"doctype":           `<!DOCTYPE svg [<!ENTITY a "b">]>` + open + `&a;</svg>`,
		"not svg":           `<html><body/></html>`,
		"wrong namespace":   `<svg xmlns="http://example.test/"><path d="M0 0"/></svg>`,
		"empty":             ``,
		"not xml":           `<svg`,
		"trailing content":  open + `</svg><script/>`,
		"nul":               open + "\x00</svg>",
		// review finding (v0.8.0): stored XSS through a comment that HTML closes at "<!-->".
		"comment payload":   open + `<!--><img/src="x"/onerror="alert(1)">--></svg>`,
		"image-set style":   open + `<rect style="background-image:image-set('https://example.test/a.png' 1x)"/></svg>`,
		"css escape style":  open + `<rect style="fill:u\72l(https://example.test/a)"/></svg>`,
		"css escape attr":   open + `<rect fill="u\72l(https://example.test/a)"/></svg>`,
		"animateTransform":  open + `<g><animateTransform attributeName="transform" type="rotate"/></g></svg>`,
		"html p element":    open + `<p><img src="x"onerror="alert(1)"/></p></svg>`,
		"processing instr":  open + `<?php echo 1 ?></svg>`,
		"use cycle":         open + `<g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></svg>`,
		"use of a use":      open + `<path id="p"/><use id="u" href="#p"/><use href="#u"/></svg>`,
		"unknown attribute": open + `<path foo="1"/></svg>`,
		"duplicate id":      open + `<g id="a"/><g id="a"/></svg>`,
		"text in a group":   open + `<g>hello</g></svg>`,
	} {
		if err := CheckSVG([]byte(svg)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestCheckSVGSizeAndDepth(t *testing.T) {
	big := `<svg xmlns="http://www.w3.org/2000/svg"><path d="` + strings.Repeat("M0 0", MaxSVGBytes/3) + `"/></svg>`
	if err := CheckSVG([]byte(big)); err == nil {
		t.Error("an SVG over the size limit was accepted")
	}
	deep := `<svg xmlns="http://www.w3.org/2000/svg">` + strings.Repeat("<g>", 200) + strings.Repeat("</g>", 200) + `</svg>`
	if err := CheckSVG([]byte(deep)); err == nil {
		t.Error("an SVG nested 200 deep was accepted")
	}
}

func TestCheckSVGUseCountIsBounded(t *testing.T) {
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg"><path id="p" d="M0 0"/>`)
	for i := 0; i < maxSVGUses+1; i++ {
		b.WriteString(`<use href="#p"/>`)
	}
	b.WriteString(`</svg>`)
	if err := CheckSVG([]byte(b.String())); err == nil {
		t.Error("more <use> than the bound was accepted")
	}
}

// The canonical form is what is stored: it never carries a comment, so HTML's
// parser has nothing to close early, and canonicalising it again changes nothing.
func TestCanonicalSVGIsInertAndStable(t *testing.T) {
	in := `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><title>a &lt;!--&gt; b</title><path style="fill:#000" d="M0 0"/></svg>`
	got, err := CanonicalSVG([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	const want = `<svg xmlns="http://www.w3.org/2000/svg"><title>a &lt;!--&gt; b</title><path fill="#000" d="M0 0"/></svg>`
	if string(got) != want {
		t.Errorf("canonical = %s, want %s", got, want)
	}
	again, err := CanonicalSVG(got)
	if err != nil || string(again) != string(got) {
		t.Errorf("not stable: %s, %v", again, err)
	}
}
