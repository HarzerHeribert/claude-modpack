import { default as DiscussionsRoute } from '@/app/routes/app/discussions/discussions';
import {
  createDiscussion,
  createUser,
  renderApp,
  screen,
  within,
} from '@/testing/test-utils';

// Hidden below md, shown from md up: `hidden md:table-cell` (or md:block, md:flex …) or `max-md:hidden`.
const responsive = (el: Element) => {
  const t = (el.getAttribute('class') || '').split(/\s+/);
  const shownFromMd = t.some((c) => /^md:(table-cell|block|flex|inline|inline-block|inline-flex|grid|contents|table)$/.test(c));
  return (t.includes('hidden') && shownFromMd) || t.includes('max-md:hidden');
};
const hidden = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).some((c) => c === 'hidden' || c === 'max-md:hidden' || c === 'sm:hidden');

test('Created At is hidden below md, in the header and in every row', { timeout: 15000 }, async () => {
  const user = await createUser();
  await createDiscussion({ title: 'First topic', teamId: user.teamId, authorId: user.id });
  await createDiscussion({ title: 'Second topic', teamId: user.teamId, authorId: user.id });
  await renderApp(<DiscussionsRoute />, { user });
  await screen.findByText('Second topic', {}, { timeout: 5000 });

  const headers = screen.getAllByRole('columnheader');
  const index = headers.findIndex((h) => /created at/i.test(h.textContent || ''));
  expect(index).toBeGreaterThanOrEqual(0);
  expect(responsive(headers[index])).toBe(true);

  const rows = screen.getAllByRole('row').slice(1);
  expect(rows.length).toBe(2);
  for (const row of rows) {
    const cells = within(row).getAllByRole('cell');
    expect(responsive(cells[index])).toBe(true);
  }
});

test('the other columns stay visible on phones', { timeout: 15000 }, async () => {
  const user = await createUser();
  await createDiscussion({ title: 'Only topic', teamId: user.teamId, authorId: user.id });
  await renderApp(<DiscussionsRoute />, { user });
  await screen.findByText('Only topic', {}, { timeout: 5000 });
  const headers = screen.getAllByRole('columnheader');
  const title = headers.find((h) => /title/i.test(h.textContent || ''))!;
  expect(hidden(title)).toBe(false);
  const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
  expect(hidden(cells[0])).toBe(false);
});
