-- Guard: delete duplicate CarPhotos, keeping only the most recent per car.
DELETE FROM "CarPhoto"
WHERE id NOT IN (
  SELECT DISTINCT ON ("carId") id
  FROM "CarPhoto"
  ORDER BY "carId", "createdAt" DESC
);

-- CreateIndex
CREATE UNIQUE INDEX "CarPhoto_carId_key" ON "CarPhoto"("carId");
