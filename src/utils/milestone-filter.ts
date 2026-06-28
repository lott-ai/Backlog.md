import Fuse from "fuse.js";
import type { Milestone } from "../types/index.ts";
import { formatMultiSelectSummary } from "./label-filter.ts";

export const NO_MILESTONE_FILTER_VALUE = "\u0000no-milestone";
export const NO_MILESTONE_FILTER_LABEL = "No milestone";

export function milestoneValuesToPickerLabels(values: string[]): string[] {
	return values.map((value) => (value === NO_MILESTONE_FILTER_VALUE ? NO_MILESTONE_FILTER_LABEL : value));
}

export function milestonePickerLabelsToValues(labels: string[]): string[] {
	return labels.map((label) => (label === NO_MILESTONE_FILTER_LABEL ? NO_MILESTONE_FILTER_VALUE : label));
}

export function formatMilestoneFilterSummary(values: string[], fallback = "All"): string {
	if (!values.length) {
		return fallback;
	}
	return formatMultiSelectSummary(milestoneValuesToPickerLabels(values), fallback);
}

interface MilestoneCandidate {
	value: string;
	compact: string;
}

export function createMilestoneFilterValueResolver(milestones: Milestone[]): (milestoneValue: string) => string {
	const milestoneLabelsByKey = new Map<string, string>();
	for (const milestone of milestones) {
		const normalizedId = milestone.id.trim();
		const normalizedTitle = milestone.title.trim();
		if (!normalizedId || !normalizedTitle) continue;
		milestoneLabelsByKey.set(normalizedId.toLowerCase(), normalizedTitle);
		const idMatch = normalizedId.match(/^m-(\d+)$/i);
		if (idMatch?.[1]) {
			const numericAlias = String(Number.parseInt(idMatch[1], 10));
			milestoneLabelsByKey.set(`m-${numericAlias}`, normalizedTitle);
			milestoneLabelsByKey.set(numericAlias, normalizedTitle);
		}
		milestoneLabelsByKey.set(normalizedTitle.toLowerCase(), normalizedTitle);
	}

	return (milestoneValue: string) => {
		const normalized = milestoneValue.trim();
		if (!normalized) return milestoneValue;
		return milestoneLabelsByKey.get(normalized.toLowerCase()) ?? milestoneValue;
	};
}

export function normalizeMilestoneFilterValue(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function compactMilestoneFilterValue(value: string): string {
	return value.replace(/\s+/g, "");
}

export function resolveClosestMilestoneFilterValue(query: string, milestoneValues: string[]): string {
	const normalizedQuery = normalizeMilestoneFilterValue(query);
	if (!normalizedQuery) {
		return normalizedQuery;
	}

	const normalizedCandidates = Array.from(
		new Set(milestoneValues.map((value) => normalizeMilestoneFilterValue(value)).filter(Boolean)),
	).sort((left, right) => left.localeCompare(right));

	if (normalizedCandidates.length === 0) {
		return normalizedQuery;
	}

	if (normalizedCandidates.includes(normalizedQuery)) {
		return normalizedQuery;
	}

	const candidates: MilestoneCandidate[] = normalizedCandidates.map((value) => ({
		value,
		compact: compactMilestoneFilterValue(value),
	}));

	const fuse = new Fuse(candidates, {
		includeScore: true,
		threshold: 0.45,
		ignoreLocation: true,
		minMatchCharLength: 2,
		keys: [
			{ name: "value", weight: 0.7 },
			{ name: "compact", weight: 0.3 },
		],
	});

	const compactQuery = compactMilestoneFilterValue(normalizedQuery);
	const best =
		fuse.search(normalizedQuery)[0]?.item.value ??
		(compactQuery ? fuse.search(compactQuery)[0]?.item.value : undefined);

	return best ?? normalizedQuery;
}
