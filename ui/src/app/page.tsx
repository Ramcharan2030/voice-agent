import { isNextRouterError } from "next/dist/client/components/is-next-router-error";
import { redirect } from "next/navigation";

import SignInClient from "@/components/SignInClient";
import { getServerAccessToken,getServerAuthProvider,getServerUser } from "@/lib/auth/server";
import logger from '@/lib/logger';
import { getRedirectUrl } from "@/lib/utils";

export const dynamic = 'force-dynamic';

export default async function Home() {
  logger.debug('[HomePage] Starting Home page render');
  const authProvider = await getServerAuthProvider();
  logger.debug('[HomePage] Auth provider:', authProvider);

  // For local auth, route managed customer users away from authoring surfaces.
  if (authProvider === 'local') {
    logger.debug('[HomePage] Local provider detected, checking access');

    try {
      const accessToken = await getServerAccessToken();
      if (accessToken) {
        const redirectUrl = await getRedirectUrl(accessToken, []);
        logger.debug('[HomePage] Redirecting local user to:', redirectUrl);
        redirect(redirectUrl);
      } else {
        redirect('/auth/login');
      }
    } catch (error) {
      // Re-throw navigation errors (redirects, not found, etc.) - they're intentional
      if (isNextRouterError(error)) {
        throw error;
      }

      logger.error('[HomePage] Error checking workflows for local provider:', error);
      logger.debug('[HomePage] Defaulting to /usage due to error');
      redirect('/usage');
    }
  }

  logger.debug('[HomePage] Getting server user...');
  const user = await getServerUser();

  logger.debug('[HomePage] Server user result:', {
    hasUser: !!user,
    userId: user?.id,
    authProvider
  });

  if (user) {
    try {
      // For Stack provider, get the token and permissions
      if (authProvider === 'stack' && 'getAuthJson' in user) {
        logger.debug('[HomePage] Getting auth token from Stack user...');
        const token = await user.getAuthJson();
        logger.debug('[HomePage] Got auth token:', { hasToken: !!token?.accessToken });
        const permissions = 'listPermissions' in user && 'selectedTeam' in user
          ? await user.listPermissions(user.selectedTeam!) ?? []
          : [];
        logger.debug('[HomePage] Got permissions:', { count: permissions.length });
        logger.debug('[HomePage] Getting redirect URL...');
        const redirectUrl = await getRedirectUrl(token?.accessToken ?? "", permissions);
        logger.debug('[HomePage] Redirecting to:', redirectUrl);
        redirect(redirectUrl);
      }
    } catch (error) {
      // If it's a Next.js redirect, let it through
      if (error instanceof Error && 'digest' in error &&
          typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT')) {
        throw error;
      }
      // Only catch actual API errors
      console.error("API unavailable, showing sign-in:", error);
      // Show sign-in page if API is unavailable
    }
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
      }}
    >
      <SignInClient />
    </div>
  );
}
