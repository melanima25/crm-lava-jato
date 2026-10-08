-- AlterTable
ALTER TABLE "Product" ADD COLUMN "minStockQuantity" INTEGER;

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "cashEntryId" INTEGER,
    "serviceOrderItemId" INTEGER,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "CashEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_serviceOrderItemId_fkey" FOREIGN KEY ("serviceOrderItemId") REFERENCES "ServiceOrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_serviceOrderItemId_key" ON "StockMovement"("serviceOrderItemId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_occurredAt_idx" ON "StockMovement"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_cashEntryId_idx" ON "StockMovement"("cashEntryId");
