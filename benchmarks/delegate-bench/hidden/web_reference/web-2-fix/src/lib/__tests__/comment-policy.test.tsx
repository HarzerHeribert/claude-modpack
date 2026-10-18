import { POLICIES } from '../authorization';

const user = (id: string, role: 'ADMIN' | 'USER') => ({ id, role, teamId: 'team-1' }) as any;
const comment = (authorId: string) => ({ id: 'c1', body: 'b', discussionId: 'd1', createdAt: 0, author: user(authorId, 'USER') }) as any;

test('a regular user may delete their own comment', () => {
  expect(POLICIES['comment:delete'](user('u1', 'USER'), comment('u1'))).toBe(true);
});

test("a regular user may not delete someone else's comment", () => {
  expect(POLICIES['comment:delete'](user('u1', 'USER'), comment('u2'))).toBe(false);
});

test('an admin may delete any comment', () => {
  expect(POLICIES['comment:delete'](user('u1', 'ADMIN'), comment('u2'))).toBe(true);
});
