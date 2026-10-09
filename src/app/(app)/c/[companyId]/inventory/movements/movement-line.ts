export type MovementLine = { key: string; itemId: string; quantity: string; unitCost: string };

let seq = 0;
/** Uus tühi rida (kasutatakse nii serveris kui kliendis). */
export const newMovementLine = (patch: Partial<MovementLine> = {}): MovementLine => ({ key: `m${seq++}`, itemId: "", quantity: "", unitCost: "", ...patch });
