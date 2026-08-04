<?php

declare(strict_types=1);

namespace App\Actions;

use App\Actions\Billing\EnforceAiUsageLimit;
use App\Data\ChatStreamTurn;
use App\Enums\ModelName;
use App\Jobs\ProcessChatStream;
use App\Models\Conversation;
use App\Models\History;
use App\Models\User;
use App\Services\StreamEventStore;
use Illuminate\Support\Collection;
use Laravel\Ai\Approvals\PendingApproval;
use Laravel\Ai\Exceptions\ApprovalMismatchException;

final readonly class ResumeChatStream
{
    public function __construct(
        private EnforceAiUsageLimit $enforceAiUsageLimit,
        private StreamEventStore $events,
        private CreatePendingChatStreamTurn $pendingTurn,
    ) {}

    /**
     * @param  array<string, array{action: string, result?: string|null}>  $decisions  keyed by tool call ID
     *
     * @throws ApprovalMismatchException when the decisions do not match the conversation's paused turn
     */
    public function handle(Conversation $conversation, User $user, array $decisions, string $channel = 'web', ?string $locale = null): ChatStreamTurn
    {
        $paused = $conversation->pausedApprovalTurn();

        if (! $paused instanceof History) {
            throw new ApprovalMismatchException('This conversation has no tool call awaiting approval.', new Collection);
        }

        $unknown = array_diff(array_keys($decisions), array_keys($paused->pendingApprovals()));

        if ($unknown !== []) {
            throw new ApprovalMismatchException(
                'The approval decisions do not match a paused conversation turn.',
                $this->pendingApprovalsOn($paused),
            );
        }

        $modelName = $this->modelFor($paused);
        $this->enforceAiUsageLimit->handle($user, $modelName);

        $this->events->clear($conversation->id);

        $turn = $this->pendingTurn->forResume($conversation, $user, $channel, $modelName->value);

        dispatch(new ProcessChatStream(
            userId: $user->id,
            conversationId: $conversation->id,
            modelName: $modelName->value,
            channel: $channel,
            streamId: $turn->streamId,
            userMessageId: null,
            assistantMessageId: $turn->assistantMessageId,
            locale: $locale,
            decisions: $this->normalizeDecisions($decisions),
        ));

        return $turn;
    }

    /**
     * @return Collection<int, PendingApproval>
     */
    private function pendingApprovalsOn(History $paused): Collection
    {
        $tools = [];
        $arguments = [];

        foreach ($paused->tool_calls ?? [] as $toolCall) {
            $tools[$toolCall['id']] = $toolCall['name'];
            $arguments[$toolCall['id']] = $toolCall['arguments'] ?? [];
        }

        return (new Collection($paused->pendingApprovals()))
            ->map(fn (?string $reason, string $toolCallId): PendingApproval => new PendingApproval(
                id: $toolCallId,
                tool: $tools[$toolCallId] ?? '',
                arguments: $arguments[$toolCallId] ?? [],
                reason: $reason,
            ))
            ->values();
    }

    private function modelFor(History $paused): ModelName
    {
        $model = $paused->chatStreamMeta()['model'] ?? null;

        return (is_string($model) ? ModelName::tryFrom($model) : null) ?? ModelName::default();
    }

    /**
     * @param  array<string, array{action: string, result?: string|null}>  $decisions
     * @return list<array{id: string, action: string, result: string|null}>
     */
    private function normalizeDecisions(array $decisions): array
    {
        $normalized = [];

        foreach ($decisions as $toolCallId => $decision) {
            $normalized[] = [
                'id' => (string) $toolCallId,
                'action' => $decision['action'],
                'result' => $decision['result'] ?? null,
            ];
        }

        return $normalized;
    }
}
