<?php

declare(strict_types=1);

namespace App\Actions;

use App\Data\HealthLogData;
use App\Enums\HealthEntrySource;
use App\Models\AnalysisDraft;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

final readonly class LogReviewedMealAction
{
    public function __construct(
        private RecordHealthSampleAction $recordHealthSample,
        private DispatchAggregateUserUtcDatesAction $dispatchAggregateUserUtcDates,
    ) {}

    public function handle(AnalysisDraft $draft, HealthLogData $data, User $user): string
    {
        return DB::transaction(function () use ($draft, $data, $user): string {
            $consumed = AnalysisDraft::query()
                ->whereKey($draft->id)
                ->where('user_id', $user->id)
                ->whereNull('consumed_at')
                ->update(['consumed_at' => now()]);

            if ($consumed === 0) {
                return $this->previouslyRecordedGroupId($draft, $user);
            }

            $sample = $this->recordHealthSample->handle($data, $user, HealthEntrySource::Web);
            $groupId = (string) $sample->group_id;

            AnalysisDraft::query()
                ->whereKey($draft->id)
                ->update(['health_group_id' => $groupId]);

            $this->dispatchAggregateUserUtcDates->handle(
                $user,
                [$sample->measured_at->copy()->utc()->toDateString()],
            );

            return $groupId;
        });
    }

    private function previouslyRecordedGroupId(AnalysisDraft $draft, User $user): string
    {
        $groupId = AnalysisDraft::query()
            ->whereKey($draft->id)
            ->where('user_id', $user->id)
            ->value('health_group_id');

        if (! is_string($groupId) || $groupId === '') {
            throw new InvalidArgumentException('Analysis draft cannot be consumed by this user.');
        }

        return $groupId;
    }
}
