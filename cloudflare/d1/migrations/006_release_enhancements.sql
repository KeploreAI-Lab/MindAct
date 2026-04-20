-- Migration 006: Add external download URL support to release_assets
-- If download_url is set on an asset, that URL is used for downloads instead of the R2 proxy.
-- This allows admins to link to GitHub releases or other CDNs without uploading binaries to R2.

ALTER TABLE release_assets ADD COLUMN download_url TEXT DEFAULT NULL;
