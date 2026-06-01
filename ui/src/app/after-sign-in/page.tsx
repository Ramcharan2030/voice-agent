import { isNextRouterError } from "next/dist/client/components/is-next-router-error";
import { redirect } from "next/navigation";

import { getServerAccessToken,getServerAuthProvider, getServerUser } from "@/lib/auth/server";
import logger from '@/lib/logger';
import { getRedirectUrl } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default async function AfterSignInPage() {
    logger.debug('[AfterSignInPage] Starting after-sign-in page');
    const authProvider = await getServerAuthProvider();
    logger.debug('[AfterSignInPage] Auth provider:', authProvider);
    logger.debug('[AfterSignInPage] Getting server user...');
    const user = await getServerUser();
    logger.debug('[AfterSignInPage] Got user:', { hasUser: !!user, userId: user?.id });

    if (authProvider === 'stack' && user && 'getAuthJson' in user) {
        logger.debug('[AfterSignInPage] Stack user detected, getting auth token...');
        const token = await user.getAuthJson();
        logger.debug('[AfterSignInPage] Got token:', { hasToken: !!token?.accessToken });
        const permissions = 'listPermissions' in user && 'selectedTeam' in user
            ? await user.listPermissions(user.selectedTeam!) ?? []
            : [];
        logger.debug('[AfterSignInPage] Got permissions:', { count: permissions.length });
        const redirectUrl = await getRedirectUrl(token?.accessToken ?? "", permissions);
        logger.debug('[AfterSignInPage] Redirecting to:', redirectUrl);
        redirect(redirectUrl);
    }

    logger.debug('[AfterSignInPage] Checking local access before fallback');

    try {
        const accessToken = await getServerAccessToken();
        if (accessToken) {
            const redirectUrl = await getRedirectUrl(accessToken, []);
            logger.debug('[AfterSignInPage] Redirecting local user to:', redirectUrl);
            redirect(redirectUrl);
        }
    } catch (error) {
        if (isNextRouterError(error)) {
            throw error;
        }
        logger.error('[AfterSignInPage] Error checking workflows:', error);
    }

    // Default fallback
    logger.debug('[AfterSignInPage] Final fallback redirect to /usage');
    redirect('/usage');
}
