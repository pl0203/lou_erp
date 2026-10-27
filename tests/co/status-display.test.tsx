import "./ui-harness";
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { COBadges } from '../../src/components/co/COShared';
afterEach(cleanup);
test.each([['not_started','Belum dikirim','amber'],['partial','Terkirim sebagian','blue'],['complete','Terkirim penuh','green']] as const)('active CO displays only %s delivery progress with distinct colour', (progress, label, color) => {
    const { container } = render(<COBadges status="active" progress={progress} />);
    expect(container.querySelectorAll('.ui-status-badge')).toHaveLength(1);
    expect(screen.queryByText('Aktif')).toBeNull();
    expect(screen.getByText(label).className).toContain(`co-status--${color}`);
});
test.each(['closed','cancelled'] as const)('inactive %s CO has one muted Non-aktif badge without delivery progress', status => {
    const { container } = render(<COBadges status={status} progress="complete" />);
    expect(container.querySelectorAll('.ui-status-badge')).toHaveLength(1);
    expect(screen.getByText('Non-aktif').className).toContain('co-status--inactive');
    expect(screen.queryByText('Terkirim penuh')).toBeNull();
});
