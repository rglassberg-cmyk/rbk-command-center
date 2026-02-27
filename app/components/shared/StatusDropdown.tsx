'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Clock, RefreshCw, CheckCircle, Archive } from 'lucide-react';
import { statusConfig } from '@/lib/constants';

interface StatusDropdownProps {
  currentStatus: string;
  onStatusChange: (status: string) => void;
  disabled?: boolean;
}

const statusOptions = [
  { key: 'pending', icon: Clock },
  { key: 'in_progress', icon: RefreshCw },
  { key: 'done', icon: CheckCircle },
  { key: 'archived', icon: Archive },
] as const;

export function StatusDropdown({
  currentStatus,
  onStatusChange,
  disabled = false,
}: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const currentConfig = statusConfig[currentStatus];
  const CurrentIcon = statusOptions.find((s) => s.key === currentStatus)?.icon || Clock;

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setFocusedIndex(-1);
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, closeDropdown]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isOpen && focusedIndex >= 0) {
          onStatusChange(statusOptions[focusedIndex].key);
          closeDropdown();
        } else {
          setIsOpen(true);
          setFocusedIndex(statusOptions.findIndex((s) => s.key === currentStatus));
        }
        break;
      case 'Escape':
        closeDropdown();
        buttonRef.current?.focus();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setFocusedIndex(0);
        } else {
          setFocusedIndex((i) => (i < statusOptions.length - 1 ? i + 1 : 0));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setFocusedIndex((i) => (i > 0 ? i - 1 : statusOptions.length - 1));
        }
        break;
      case 'Tab':
        closeDropdown();
        break;
    }
  };

  const handleOptionClick = (status: string) => {
    onStatusChange(status);
    closeDropdown();
    buttonRef.current?.focus();
  };

  return (
    <div ref={dropdownRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          inline-flex items-center gap-2 px-3 py-1.5
          text-sm font-medium rounded-lg
          border transition-colors duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${currentConfig?.bgColor || 'bg-slate-50'}
          ${currentConfig?.textColor || 'text-slate-700'}
          ${currentConfig?.borderColor || 'border-slate-200'}
          hover:bg-opacity-80
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <CurrentIcon className="w-4 h-4" />
        <span>{currentConfig?.label || 'Status'}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <ul
          role="listbox"
          aria-activedescendant={focusedIndex >= 0 ? `status-option-${statusOptions[focusedIndex].key}` : undefined}
          className="
            absolute z-10 mt-1 w-full min-w-[160px]
            bg-white rounded-lg border border-slate-200 shadow-sm
            py-1 overflow-hidden
          "
        >
          {statusOptions.map((option, index) => {
            const config = statusConfig[option.key];
            const Icon = option.icon;
            const isSelected = currentStatus === option.key;
            const isFocused = focusedIndex === index;

            return (
              <li
                key={option.key}
                id={`status-option-${option.key}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleOptionClick(option.key)}
                className={`
                  flex items-center gap-2 px-3 py-2 cursor-pointer
                  text-sm transition-colors duration-150
                  ${isFocused ? 'bg-slate-100' : ''}
                  ${isSelected ? 'font-medium' : ''}
                  hover:bg-slate-50
                `}
              >
                <span
                  className={`
                    flex items-center justify-center w-5 h-5 rounded-full
                    ${config.bgColor} ${config.textColor}
                  `}
                >
                  <Icon className="w-3 h-3" />
                </span>
                <span className="text-slate-700">{config.label}</span>
                {isSelected && (
                  <CheckCircle className="w-4 h-4 ml-auto text-blue-600" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default StatusDropdown;
