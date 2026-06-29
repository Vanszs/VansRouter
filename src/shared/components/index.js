"use client";

import dynamic from "next/dynamic";

// Shared Components - Export all
export { default as Button } from "./Button";
export { default as Input } from "./Input";
export { default as Select } from "./Select";
export { default as Card } from "./Card";
export { default as Modal, ConfirmModal } from "./Modal";
export { default as Loading, Spinner, PageLoading, Skeleton, CardSkeleton } from "./Loading";
export { default as Avatar } from "./Avatar";
export { default as Badge } from "./Badge";
export { default as Toggle } from "./Toggle";
export { default as ThemeToggle } from "./ThemeToggle";
export { ThemeProvider } from "./ThemeProvider";
export { default as Sidebar } from "./Sidebar";
export { default as Header } from "./Header";
export { default as Footer } from "./Footer";

// Heavy modals are lazy-loaded because they are not visible on initial render.
// This reduces the initial JS bundle on every dashboard route.
const lazyModal = (factory) => dynamic(factory, { ssr: false, loading: () => null });

export const OAuthModal = lazyModal(() => import("./OAuthModal"));
export const ModelSelectModal = lazyModal(() => import("./ModelSelectModal"));
export const ManualConfigModal = lazyModal(() => import("./ManualConfigModal"));
export const ComboFormModal = lazyModal(() => import("./ComboFormModal"));
export const McpMarketplaceModal = lazyModal(() => import("./McpMarketplaceModal"));
export const KiroAuthModal = lazyModal(() => import("./KiroAuthModal"));
export const KiroOAuthWrapper = lazyModal(() => import("./KiroOAuthWrapper"));
export const KiroSocialOAuthModal = lazyModal(() => import("./KiroSocialOAuthModal"));
export const CursorAuthModal = lazyModal(() => import("./CursorAuthModal"));
export const IFlowCookieModal = lazyModal(() => import("./IFlowCookieModal"));
export const GitLabAuthModal = lazyModal(() => import("./GitLabAuthModal"));
export const EditConnectionModal = lazyModal(() => import("./EditConnectionModal"));
export const AddCustomEmbeddingModal = lazyModal(() => import("./AddCustomEmbeddingModal"));
export const NoAuthProxyCard = lazyModal(() => import("./NoAuthProxyCard"));
export const ChangelogModal = lazyModal(() => import("./ChangelogModal"));
export const ProviderInfoCard = lazyModal(() => import("./ProviderInfoCard"));

export { default as UsageStats } from "./UsageStats";
export { default as LanguageSwitcher } from "./LanguageSwitcher";
export { default as NineRemoteButton } from "./NineRemoteButton";
export { default as HeaderMenu } from "./HeaderMenu";
export { default as RequestLogger } from "./RequestLogger";
export { default as SegmentedControl } from "./SegmentedControl";
export { default as Tooltip } from "./Tooltip";
export { default as CapacityBadges } from "./CapacityBadges";

// Layouts
export * from "./layouts";


