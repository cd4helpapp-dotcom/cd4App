-- Doctors can remove their own slots as long as nobody has booked them.
-- (There was no DELETE policy, so the app could not offer "delete slot".)
DROP POLICY IF EXISTS "Slots delete own unbooked" ON public.slots;
CREATE POLICY "Slots delete own unbooked"
ON public.slots
FOR DELETE
TO authenticated
USING (
  doctor_id = auth.uid()
  AND COALESCE(is_booked, false) = false
);
