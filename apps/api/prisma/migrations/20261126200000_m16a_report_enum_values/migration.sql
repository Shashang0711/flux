-- M16 (1/2): new enum values. PostgreSQL cannot use a value added in the same transaction, so these
-- come first; m16b adds the tables and the rules that use them.

ALTER TYPE "FilePurpose" ADD VALUE 'FINAL_REPORT';
ALTER TYPE "LabReportStatus" ADD VALUE 'PUBLISHED';
