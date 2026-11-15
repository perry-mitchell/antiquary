import { Badge } from '@radix-ui/themes';

const HEAT_COLORS: Record<
    number,
    'cyan' | 'teal' | 'grass' | 'yellow' | 'amber' | 'orange' | 'tomato'
> = {
    1: 'cyan',
    2: 'teal',
    3: 'grass',
    4: 'yellow',
    5: 'amber',
    6: 'orange',
    7: 'tomato',
};

interface RarityTagProps {
    rarity: number;
    rarityLabel?: string | null;
    rarityPercent?: number | null;
}

/** Heat-coded rarity tag; levels 8-10 use stars instead of a number. */
export function RarityTag({ rarity, rarityLabel, rarityPercent }: RarityTagProps) {
    const stars = rarity >= 8 ? '★'.repeat(rarity - 7) : null;
    const detail = [
        `Rarity ${rarity}/10`,
        rarityLabel ?? null,
        typeof rarityPercent === 'number' ? `${rarityPercent}%` : null,
    ]
        .filter(Boolean)
        .join(' — ');
    return (
        <Badge
            color={rarity >= 8 ? 'gold' : (HEAT_COLORS[rarity] ?? 'gray')}
            variant="soft"
            title={detail}
            data-testid="rarity-tag"
        >
            {stars ?? `R${rarity}`}
        </Badge>
    );
}
