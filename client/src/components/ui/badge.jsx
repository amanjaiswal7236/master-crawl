import { cn } from '../../lib/utils';

export function Badge({ className, variant = 'default', ...props }) {
  const variants = {
    default: 'border-transparent bg-primary text-primary-foreground shadow-xs',
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    destructive: 'border-transparent bg-destructive text-destructive-foreground shadow-xs',
    outline: 'border [border-color:var(--badge-outline)] shadow-xs',
  };
  
  return (
    <div
      className={cn(
        'whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover-elevate',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

