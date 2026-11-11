import { StarIcon } from '@radix-ui/react-icons';
import { Flex } from '@radix-ui/themes';

export function StarRating({
    value,
    onChange,
    size = 18,
}: {
    value: number;
    onChange?: (value: number) => void;
    size?: number;
}) {
    return (
        <Flex gap="1" align="center">
            {[1, 2, 3, 4, 5].map((star) => {
                const filled = star <= value;
                const content = (
                    <StarIcon
                        width={size}
                        height={size}
                        color={filled ? 'var(--amber-9)' : 'var(--gray-a7)'}
                    />
                );
                if (!onChange) {
                    return <span key={star}>{content}</span>;
                }
                return (
                    <button
                        key={star}
                        type="button"
                        aria-label={`Rate ${star} of 5`}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: 2,
                            cursor: 'pointer',
                            lineHeight: 0,
                        }}
                        onClick={() => onChange(value === star ? 0 : star)}
                        data-testid={`rating-star-${star}`}
                    >
                        {content}
                    </button>
                );
            })}
        </Flex>
    );
}
