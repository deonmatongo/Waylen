-- CreateTable
CREATE TABLE "career_assessment_results" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "recommendedCategory" "OpportunityCategory" NOT NULL,
    "secondaryCategory" "OpportunityCategory",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "career_assessment_results_studentProfileId_createdAt_idx" ON "career_assessment_results"("studentProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "career_assessment_results" ADD CONSTRAINT "career_assessment_results_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
