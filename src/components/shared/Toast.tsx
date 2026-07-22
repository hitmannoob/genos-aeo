'use client'
import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, XCircle, Info, X } from 'lucide-react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastProps extends Toast {
  onRemove: (id: string) => void;
}

const ToastComponent: React.FC<ToastProps> = ({
  id,
  type,
  title,
  message,
  duration = 5000,
  action,
  onRemove
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Trigger animation
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleRemove();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(id), 300);
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-success" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-warning" />;
      case 'info':
        return <Info className="h-5 w-5 text-primary" />;
    }
  };

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return 'bg-card border-success/40';
      case 'error':
        return 'bg-card border-destructive/40';
      case 'warning':
        return 'bg-card border-warning/40';
      case 'info':
        return 'bg-card border-primary/40';
    }
  };

  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`
        transform transition-all duration-300 ease-in-out
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        ${getBackgroundColor()}
        border rounded-lg p-4 shadow-lg max-w-md w-full
      `}
    >
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {message && (
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          )}
          {action && (
            <div className="mt-3">
              <button
                onClick={action.onClick}
                className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {action.label}
              </button>
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Dismiss notification"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToastComponent;
