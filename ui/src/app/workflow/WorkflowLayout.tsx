import React, { ReactNode } from 'react';

import { BreadcrumbItem,Breadcrumbs } from '@/components/Breadcrumbs';

interface WorkflowLayoutProps {
    children: ReactNode;
    headerActions?: ReactNode;
    breadcrumbs?: BreadcrumbItem[];
}

const WorkflowLayout: React.FC<WorkflowLayoutProps> = ({ children, breadcrumbs }) => {
    return (
        <div className="flex flex-col h-full">
            {breadcrumbs && breadcrumbs.length > 0 && (
                <div className="px-4 py-3 border-b bg-background">
                    <Breadcrumbs items={breadcrumbs} />
                </div>
            )}
            {children}
        </div>
    );
};

export default WorkflowLayout;
