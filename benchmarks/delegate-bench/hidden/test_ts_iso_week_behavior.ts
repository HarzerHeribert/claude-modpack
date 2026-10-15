// Hidden tests for ts-l1-feature (chrono): ISO 8601 week dates, as the task's spec states them, through chrono's API.
// Copied into test/ only for grading. Each negative case carries a positive anchor, so none passes without the parser.
import * as chrono from "../src";

const REF = new Date(2026, 9, 15, 9, 0);

const ymd = (r: chrono.ParsedResult) => [r.start.get("year"), r.start.get("month"), r.start.get("day")];
const weekResults = (text: string) => chrono.parse(text, REF).filter((r) => /w/i.test(r.text));

test("YYYY-Www-D is that day of the ISO week", () => {
    const results = chrono.parse("2026-W42-3", REF);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("2026-W42-3");
    expect(results[0].index).toBe(0);
    expect(ymd(results[0])).toEqual([2026, 10, 14]);
    expect(results[0].start.get("weekday")).toBe(3);
});

test("YYYY-Www is the Monday of that week", () => {
    const [r] = chrono.parse("2026-W42", REF);
    expect(r.text).toBe("2026-W42");
    expect(ymd(r)).toEqual([2026, 10, 12]);
    expect(r.start.get("weekday")).toBe(1);
});

test("the compact forms YYYYWwwD and YYYYWww", () => {
    const [a] = chrono.parse("2026W423", REF);
    expect(a.text).toBe("2026W423");
    expect(ymd(a)).toEqual([2026, 10, 14]);
    const [b] = chrono.parse("2026W42", REF);
    expect(b.text).toBe("2026W42");
    expect(ymd(b)).toEqual([2026, 10, 12]);
});

test("a lowercase w, and a week 1 that starts in the previous year", () => {
    const [r] = chrono.parse("2026-w01-1", REF);
    expect(r.text).toBe("2026-w01-1");
    expect(ymd(r)).toEqual([2025, 12, 29]);
});

test("week 53 of years that have one", () => {
    expect(ymd(chrono.parse("2020-W53-7", REF)[0])).toEqual([2021, 1, 3]);
    expect(ymd(chrono.parse("2026-W53-4", REF)[0])).toEqual([2026, 12, 31]);
});

test("the date is certain and the time implied", () => {
    const [r] = chrono.parse("2026-W42-5", REF);
    expect(ymd(r)).toEqual([2026, 10, 16]);
    expect(r.start.isCertain("year")).toBe(true);
    expect(r.start.isCertain("month")).toBe(true);
    expect(r.start.isCertain("day")).toBe(true);
    expect(r.start.isCertain("weekday")).toBe(true);
    expect(r.start.isCertain("hour")).toBe(false);
    expect(r.start.get("hour")).toBe(12);
});

test("found inside a sentence", () => {
    const results = chrono.parse("The release is planned for 2027-W05-2, after review.", REF);
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(27);
    expect(results[0].text).toBe("2027-W05-2");
    expect(ymd(results[0])).toEqual([2027, 2, 2]);
});

test("chrono.strict parses it too", () => {
    expect(chrono.strict.parseDate("2026-W42-3", REF)).toEqual(new Date(2026, 9, 14, 12));
});

test("the result carries the parser's tag", () => {
    const [r] = chrono.parse("2026-W42-3", REF);
    expect(r.tags().has("parser/ENISOWeekDateParser")).toBe(true);
});

test("week 53 only in years with 53 ISO weeks", () => {
    expect(weekResults("2020-W53")).toHaveLength(1);
    expect(weekResults("2021-W53")).toHaveLength(0);
});

test("week 00 and weeks above 53 are not week dates", () => {
    expect(weekResults("2026-W01")).toHaveLength(1);
    expect(weekResults("2026-W00")).toHaveLength(0);
    expect(weekResults("2026-W54-1")).toHaveLength(0);
});

test("weekday digits 0, 8 and 9 are not week dates, not even shorter ones", () => {
    expect(weekResults("2026-W42-7")).toHaveLength(1);
    expect(weekResults("2026-W42-8")).toHaveLength(0);
    expect(weekResults("2026-W42-0")).toHaveLength(0);
    expect(weekResults("2026W429")).toHaveLength(0);
});
