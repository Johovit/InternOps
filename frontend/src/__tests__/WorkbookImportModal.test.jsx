import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import WorkbookImportModal from '../components/admin/WorkbookImportModal';

vi.mock('../lib/axios', () => ({
  default: { post: vi.fn() },
}));

describe('WorkbookImportModal portal', () => {
  test('renders in document.body without rendering document.body as a child', () => {
    const onClose = vi.fn();
    const { container, unmount } = render(
      <WorkbookImportModal open onClose={onClose} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.getByRole('dialog', { name: /preview intern workbook/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Import Not Enabled Yet')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /close workbook preview/i })
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(
      screen.queryByRole('dialog', { name: /preview intern workbook/i })
    ).toBeNull();
  });
});
