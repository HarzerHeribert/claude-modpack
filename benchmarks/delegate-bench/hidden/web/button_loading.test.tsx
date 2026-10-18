import { render } from '@testing-library/react';

import { Button } from '@/components/ui/button';

test('a loading button shows the spinner', () => {
  const { container } = render(<Button {...({ loading: true } as any)}>Save</Button>);
  expect(container.querySelector('svg.animate-spin')).not.toBeNull();
});

test('a button that is not loading shows no spinner', () => {
  const { container } = render(<Button>Save</Button>);
  expect(container.querySelector('svg.animate-spin')).toBeNull();
});

test('isLoading is no prop of the button any more', () => {
  const { container } = render(<Button {...({ isLoading: true } as any)}>Save</Button>);
  expect(container.querySelector('svg.animate-spin')).toBeNull();
});
