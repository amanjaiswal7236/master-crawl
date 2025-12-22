import { cn } from '../../lib/utils';

export function Button({ 
  className, 
  variant = 'default', 
  size = 'default', 
  children, 
  ...props 
}) {
  const variants = {
    default: 'bg-primary text-primary-foreground border border-primary-border hover-elevate active-elevate-2',
    outline: 'border [border-color:var(--button-outline)] shadow-xs active:shadow-none',
    secondary: 'border bg-secondary text-secondary-foreground border-secondary-border',
    ghost: 'border border-transparent',
    destructive: 'bg-destructive text-destructive-foreground border border-destructive-border',
  };
  
  const sizes = {
    default: 'min-h-9 px-4 py-2',
    sm: 'min-h-8 rounded-md px-3 text-xs',
    lg: 'min-h-10 rounded-md px-8',
    icon: 'h-9 w-9',
  };
  
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

