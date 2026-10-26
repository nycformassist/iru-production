// ErrorBoundary around stage content (IRU mobile repair 2026-10-26).
//
// Previously there was no error boundary anywhere in src/, so any
// render-time exception became a full white-screen loss of the whole
// app. This boundary converts that into a recoverable error: the user
// can retry the step or start over, with their questionnaire answers
// untouched (the boundary holds no form state and resets nothing).
//
// Deliberately written with React.createElement instead of JSX so the
// recovery rendering is unit-testable under the existing node test
// harness (which cannot parse JSX). On the happy path render() returns
// children directly, so the DOM is unchanged. The fallback never shows
// the error object, a stack trace, document contents, or credentials —
// only a plain message and two safe actions.
import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  onStartOver?: () => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  // The repo has no @types/react, so React resolves as `any` and the
  // inherited members are unknown to tsc. These `declare` fields are
  // type-only (erased at compile time) and restore the typing without
  // changing runtime behavior; the class still extends the real
  // React.Component so React recognizes it as a class component.
  declare props: ErrorBoundaryProps;
  declare setState: (
    partial:
      | Partial<ErrorBoundaryState>
      | ((state: ErrorBoundaryState) => Partial<ErrorBoundaryState>),
  ) => void;

  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Console only — never rendered to the user.
    console.error('Stage render error:', error);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const { onStartOver } = this.props;
    return React.createElement(
      'div',
      { className: 'p-8 sm:p-12 text-center space-y-4' },
      React.createElement(
        'h2',
        { className: 'text-2xl font-serif font-semibold text-slate-900' },
        'Something went wrong on this step',
      ),
      React.createElement(
        'p',
        { className: 'text-slate-600' },
        'Your answers are still here. You can try this step again or start over.',
      ),
      React.createElement(
        'div',
        { className: 'flex flex-col sm:flex-row justify-center gap-3' },
        React.createElement(
          'button',
          {
            onClick: this.handleRetry,
            className:
              'px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors',
          },
          'Try this step again',
        ),
        onStartOver
          ? React.createElement(
              'button',
              {
                onClick: onStartOver,
                className:
                  'px-6 py-3 border-2 border-slate-300 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-colors',
              },
              'Start over',
            )
          : null,
      ),
    );
  }
}

export default ErrorBoundary;
