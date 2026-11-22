import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('React Task Manager Component (Frontend Automation Tests)', () => {
  it('renders all tasks initially', () => {
    render(<App />);
    expect(screen.getByText('Update dependencies')).toBeInTheDocument();
    expect(screen.getByText('Refactor database')).toBeInTheDocument();
    expect(screen.getByText('Fix production outage')).toBeInTheDocument();
  });

  it('filters by Low priority when Low button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Low' }));
    expect(screen.getByText('Update dependencies')).toBeInTheDocument();
    expect(screen.queryByText('Refactor database')).not.toBeInTheDocument();
    expect(screen.queryByText('Fix production outage')).not.toBeInTheDocument();
  });

  it('filters by High priority when High button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'High' }));
    expect(screen.getByText('Fix production outage')).toBeInTheDocument();
    expect(screen.queryByText('Update dependencies')).not.toBeInTheDocument();
    expect(screen.queryByText('Refactor database')).not.toBeInTheDocument();
  });
});
