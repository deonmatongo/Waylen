-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "ContractStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "emailTemplate" TEXT,
ADD COLUMN     "emailData" JSONB;

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "referredByStudentId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "student_profiles_referredByStudentId_idx" ON "student_profiles"("referredByStudentId");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_referredByStudentId_fkey" FOREIGN KEY ("referredByStudentId") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
