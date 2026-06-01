"use client";

import { useParams, useSearchParams } from "next/navigation";

import WorkflowLayout from "../../WorkflowLayout";
import { WorkflowExecutions } from "../components/WorkflowExecutions";

export default function WorkflowRunsPage() {
    const { workflowId } = useParams();
    const searchParams = useSearchParams();

    return (
        <WorkflowLayout
            breadcrumbs={[
                { label: 'Agents', href: '/workflow' },
                { label: `Agent #${workflowId}`, href: `/workflow/${workflowId}` },
                { label: 'Runs' },
            ]}
        >
            <WorkflowExecutions
                workflowId={Number(workflowId)}
                searchParams={searchParams}
            />
        </WorkflowLayout>
    );
}
