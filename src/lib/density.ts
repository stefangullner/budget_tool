/** Row height / column width presets — "compact" fits more months on screen. */
export const DENSITY = {
  normal: {
    table: 'text-xs',
    nameCol: 'w-56',
    namePad: 'px-3',
    cellPad: 'px-2',
    budgetCol: 'w-24 min-w-[5.5rem]',
    actualCol: 'w-20 min-w-[4.5rem]',
    totalCol: 'w-28',
    inputPad: 'px-2 py-1.5',
  },
  compact: {
    table: 'text-[10.5px]',
    nameCol: 'w-40',
    namePad: 'px-2',
    cellPad: 'px-1',
    budgetCol: 'w-16 min-w-[3.75rem]',
    actualCol: 'w-14 min-w-[3.25rem]',
    totalCol: 'w-20',
    inputPad: 'px-1 py-1',
  },
} as const

export type Density = (typeof DENSITY)[keyof typeof DENSITY]
