// Hidden tests for ts-t6-signature (chrono): repeatedTimeunitPattern(prefix, single, { connector }) at run time, and
// the locales whose callers pass their own connector still joining time units with it. Copied into test/ only for
// grading; it compiles against either signature (the calls go through `any`).
import * as chrono from "../src";
import { repeatedTimeunitPattern } from "../src/utils/pattern";

const call = repeatedTimeunitPattern as any;
const REF = new Date(2026, 9, 15, 9, 0);
const LATER = new Date(2026, 9, 15, 11, 30);

test("the default connector is unchanged", () => {
    expect(call("p", "(x)")).toBe("p(?:x)(?:\\s{0,5},?\\s{0,5}(?:x)){0,10}");
});

test("the connector option replaces it", () => {
    expect(call("p", "(x)", { connector: "-" })).toBe("p(?:x)(?:-(?:x)){0,10}");
});

test("an empty options object keeps the default", () => {
    expect(call("p", "(x)", {})).toBe("p(?:x)(?:\\s{0,5},?\\s{0,5}(?:x)){0,10}");
});

test("en still joins time units with 'and'", () => {
    const [r] = chrono.en.parse("in 2 hours and 30 minutes", REF);
    expect(r.text).toBe("in 2 hours and 30 minutes");
    expect(r.start.date()).toEqual(LATER);
});

test("id still joins time units with 'dan'", () => {
    const [r] = chrono.id.parse("dalam 2 jam dan 30 menit", REF);
    expect(r.text).toBe("dalam 2 jam dan 30 menit");
    expect(r.start.date()).toEqual(LATER);
});

test("it still joins time units with 'e'", () => {
    const [r] = chrono.it.parse("tra 2 ore e 30 minuti", REF);
    expect(r.text).toBe("tra 2 ore e 30 minuti");
    expect(r.start.date()).toEqual(LATER);
});

test("ar still joins time units with 'و'", () => {
    const [r] = chrono.ar.parse("خلال ساعتين و 30 دقيقة", REF);
    expect(r.text).toBe("خلال ساعتين و 30 دقيقة");
    expect(r.start.date()).toEqual(LATER);
});
