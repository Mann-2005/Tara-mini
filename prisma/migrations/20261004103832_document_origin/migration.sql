-- CreateEnum
CREATE TYPE "DocumentOrigin" AS ENUM ('UPLOAD', 'EIGENBELEG');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "origin" "DocumentOrigin" NOT NULL DEFAULT 'UPLOAD';
