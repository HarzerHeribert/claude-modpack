// Hidden tests for ts-l1-feature (chrono): the parser class where the spec puts it, and the configurations using it.
// Copied into test/ only for grading; without the module this file does not compile, and all of its tests count as failed.
import * as chrono from "../src";
import { AbstractParserWithWordBoundaryChecking } from "../src/common/parsers/AbstractParserWithWordBoundary";
import ENISOWeekDateParser from "../src/locales/en/parsers/ENISOWeekDateParser";

test("ENISOWeekDateParser derives from AbstractParserWithWordBoundaryChecking", () => {
    const Parser = ENISOWeekDateParser as any;
    expect(new Parser()).toBeInstanceOf(AbstractParserWithWordBoundaryChecking);
});

test("chrono.casual uses it", () => {
    expect(chrono.casual.parsers.some((p) => p instanceof ENISOWeekDateParser)).toBe(true);
});

test("chrono.strict uses it", () => {
    expect(chrono.strict.parsers.some((p) => p instanceof ENISOWeekDateParser)).toBe(true);
});
