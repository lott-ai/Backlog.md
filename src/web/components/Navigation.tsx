import React from 'react';
import ThemeToggle from './ThemeToggle';

import ProjectFilterDropdown from './ProjectFilterDropdown';

interface NavigationProps {
    projectName: string;
    isGlobalMode?: boolean;
}

const Navigation: React.FC<NavigationProps> = ({ projectName, isGlobalMode = false }) => {
    return (
        <nav className="px-8 h-18 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-colors duration-200">
            <div className="h-full flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{projectName || 'Loading...'}</h1>
                    {isGlobalMode && <ProjectFilterDropdown />}
                    <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">powered by</span>
                    <a
                        href="https://backlog.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300 hover:underline transition-colors duration-200"
                    >
                        Backlog.md
                    </a>
                </div>
                <ThemeToggle />
            </div>
        </nav>
    );
};

export default Navigation;