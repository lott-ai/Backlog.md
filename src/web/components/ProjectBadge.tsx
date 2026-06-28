import type { ProjectRef } from "../../types";

export function ProjectBadge({ projectName, projectKey }: Pick<ProjectRef, "projectName" | "projectKey">) {
	return (
		<span
			className="inline-flex items-center rounded-md bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-700 dark:text-stone-300"
			title={projectKey}
		>
			{projectName}
		</span>
	);
}
