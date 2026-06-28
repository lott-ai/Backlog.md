import { useEffect, useRef, useState } from "react";
import { useProjectFilter } from "../contexts/ProjectFilterContext";

interface ProjectFilterDropdownProps {
	menuId?: string;
	className?: string;
}

export default function ProjectFilterDropdown({
	menuId = "project-filter-menu",
	className = "min-w-[220px]",
}: ProjectFilterDropdownProps) {
	const { isGlobalMode, projects, selectedProjectKeys, setSelectedProjectKeys, toggleProject } = useProjectFilter();
	const [isOpen, setIsOpen] = useState(false);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				buttonRef.current &&
				menuRef.current &&
				!buttonRef.current.contains(target) &&
				!menuRef.current.contains(target)
			) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isOpen]);

	if (!isGlobalMode) {
		return null;
	}

	const healthyProjects = projects.filter((p) => p.healthy);
	const label =
		selectedProjectKeys.length === 0
			? "All projects"
			: selectedProjectKeys.length === 1
				? (healthyProjects.find((p) => p.key === selectedProjectKeys[0])?.name ?? "1 project")
				: `${selectedProjectKeys.length} projects`;

	return (
		<div className="relative">
			<button
				type="button"
				ref={buttonRef}
				onClick={() => setIsOpen((open) => !open)}
				aria-expanded={isOpen}
				aria-controls={menuId}
				className={`${className} py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200 text-left`}
			>
				<div className="flex items-center justify-between gap-2">
					<span>Projects</span>
					<span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[140px]">{label}</span>
				</div>
			</button>
			{isOpen && (
				<div
					id={menuId}
					ref={menuRef}
					className="absolute z-50 mt-2 w-[280px] max-h-64 overflow-y-auto rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
				>
					<div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
						<span className="text-xs font-medium text-gray-500 dark:text-gray-400">Filter by project</span>
						<button
							type="button"
							className="text-xs text-stone-600 dark:text-stone-400 hover:underline"
							onClick={() => setSelectedProjectKeys([])}
						>
							All
						</button>
					</div>
					{healthyProjects.length === 0 ? (
						<div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No projects registered</div>
					) : (
						healthyProjects.map((project) => {
							const isSelected =
								selectedProjectKeys.length === 0 || selectedProjectKeys.includes(project.key);
							return (
								<label
									key={project.key}
									className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/60"
								>
									<input
										type="checkbox"
										className="mt-0.5"
										checked={isSelected}
										onChange={() => toggleProject(project.key)}
									/>
									<span>
										<span className="block text-gray-900 dark:text-gray-100">{project.name}</span>
										<span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{project.key}</span>
									</span>
								</label>
							);
						})
					)}
				</div>
			)}
		</div>
	);
}
