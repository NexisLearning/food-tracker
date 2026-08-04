import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { decide } from '@/routes/approvals';
import type { ApprovalCardData, ApprovalStatus } from '@/types/chat';
import { useHttp } from '@inertiajs/react';
import { AlertCircle, Check, Clock, Loader2, X } from 'lucide-react';
import { type ComponentType, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ApprovalCardProps {
    conversationId: string;
    approval: ApprovalCardData;
}

interface ApprovalDecisionsForm {
    decisions: Record<string, { action: 'approve' | 'reject' }>;
}

interface StatusPresentation {
    badgeLabel: string;
    badgeClassName: string;
    footerLabel: string;
    footerClassName: string;
    FooterIcon: ComponentType<{ className?: string }>;
}

const STATUS_PRESENTATION: Record<ApprovalStatus, StatusPresentation> = {
    pending: {
        badgeLabel: 'Awaiting review',
        badgeClassName: 'bg-muted text-muted-foreground',
        footerLabel: 'Please approve or dismiss.',
        footerClassName: 'text-muted-foreground',
        FooterIcon: Clock,
    },
    approved: {
        badgeLabel: 'Approved',
        badgeClassName:
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        footerLabel: 'Saved successfully.',
        footerClassName: 'text-emerald-600 dark:text-emerald-400',
        FooterIcon: Check,
    },
    rejected: {
        badgeLabel: 'Dismissed',
        badgeClassName: 'bg-muted text-muted-foreground',
        footerLabel: 'Nothing was saved.',
        footerClassName: 'text-muted-foreground',
        FooterIcon: X,
    },
};

function summaryOf(approval: ApprovalCardData): string {
    if (approval.reason) {
        return approval.reason;
    }

    const summary = approval.arguments.summary;

    return typeof summary === 'string' ? summary : approval.tool;
}

export function ApprovalCard({ conversationId, approval }: ApprovalCardProps) {
    const { t } = useTranslation();
    const action = useHttp<ApprovalDecisionsForm, unknown>({ decisions: {} });
    const [status, setStatus] = useState<ApprovalStatus>(approval.status);
    const [error, setError] = useState<string | null>(null);

    const isFoodEntry = approval.arguments.log_type === 'food';

    async function submit(intent: ApprovalStatus) {
        if (action.processing || status !== 'pending') {
            return;
        }

        setError(null);

        action.transform(() => ({
            decisions: {
                [approval.toolCallId]: {
                    action: intent === 'approved' ? 'approve' : 'reject',
                },
            },
        }));

        try {
            await action.post(decide.url({ conversation: conversationId }));

            setStatus(intent);
        } catch {
            setError('Something went wrong. Please try again.');
        }
    }

    return (
        <Card className="my-2 gap-0 overflow-hidden border border-border/60 bg-card/80 backdrop-blur-sm">
            <CardContent className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-foreground">
                        {summaryOf(approval)}
                    </p>
                    <StatusBadge status={status} />
                </div>
                {isFoodEntry && (
                    <p className="mt-2 text-xs text-muted-foreground">
                        {t('tools:carb_boundary_notice')}
                    </p>
                )}
                {error && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
                        <AlertCircle className="size-3.5 shrink-0" />
                        {error}
                    </p>
                )}
            </CardContent>

            <CardFooter className="border-t border-border/40 px-4 py-2.5">
                {status === 'pending' ? (
                    <div className="flex w-full gap-2">
                        <Button
                            size="sm"
                            className="flex-1 bg-linear-to-br from-emerald-500 to-emerald-600 text-white shadow-sm transition-all hover:from-emerald-600 hover:to-emerald-700 hover:shadow-md active:scale-[0.98]"
                            disabled={action.processing}
                            onClick={() => void submit('approved')}
                        >
                            {action.processing ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Check className="size-4" />
                            )}
                            Approve
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 transition-all hover:bg-destructive/5 hover:text-destructive active:scale-[0.98]"
                            disabled={action.processing}
                            onClick={() => void submit('rejected')}
                        >
                            <X className="size-4" />
                            Dismiss
                        </Button>
                    </div>
                ) : (
                    <StatusFooter status={status} />
                )}
            </CardFooter>
        </Card>
    );
}

function StatusBadge({ status }: { status: ApprovalStatus }) {
    const { badgeLabel, badgeClassName } = STATUS_PRESENTATION[status];

    return (
        <span
            className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                badgeClassName,
            )}
        >
            {badgeLabel}
        </span>
    );
}

function StatusFooter({ status }: { status: ApprovalStatus }) {
    const { footerLabel, footerClassName, FooterIcon } =
        STATUS_PRESENTATION[status];

    return (
        <p className={cn('flex items-center gap-1.5 text-xs', footerClassName)}>
            <FooterIcon className="size-3.5" />
            {footerLabel}
        </p>
    );
}
