-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "filename" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "error_message" TEXT,
    "progress" TEXT,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "raw_text" TEXT,
    "extraction" JSONB,
    "graph" JSONB,
    "stix_bundle" JSONB,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);
