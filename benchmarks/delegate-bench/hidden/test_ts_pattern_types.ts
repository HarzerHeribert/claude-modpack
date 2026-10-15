// Hidden tests for ts-t6-signature (chrono): the TypeScript analogue of a keyword-only, renamed parameter. ts-jest
// type-checks this file, so it compiles only when a positional connector and the old name are type errors (an
// expect-error directive with no error under it is itself an error) and the options object is optional; otherwise
// both tests count as failed.
import { repeatedTimeunitPattern } from "../src/utils/pattern";

test("a positional connector and the old name are refused by the types", () => {
    // @ts-expect-error the connector is no longer positional
    repeatedTimeunitPattern("p", "(x)", "-");
    // @ts-expect-error the option is named connector
    repeatedTimeunitPattern("p", "(x)", { connectorPattern: "-" });
    expect(repeatedTimeunitPattern("p", "(x)", { connector: "-" })).toBe("p(?:x)(?:-(?:x)){0,10}");
});

test("the options object is optional", () => {
    const calls: Parameters<typeof repeatedTimeunitPattern>[] = [["p", "(x)"], ["p", "(x)", {}], ["p", "(x)", { connector: "," }]];
    expect(calls.map((args) => repeatedTimeunitPattern(...args))).toEqual([
        "p(?:x)(?:\\s{0,5},?\\s{0,5}(?:x)){0,10}",
        "p(?:x)(?:\\s{0,5},?\\s{0,5}(?:x)){0,10}",
        "p(?:x)(?:,(?:x)){0,10}",
    ]);
});
