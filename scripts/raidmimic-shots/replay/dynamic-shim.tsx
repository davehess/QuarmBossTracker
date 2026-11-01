// Stand-in for next/dynamic in the capture harness: the board's lazy 3D view loads like any React.lazy component.
import { Suspense, lazy, type ComponentType } from 'react';

export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>,
  opts?: { loading?: () => JSX.Element | null },
) {
  const L = lazy(async () => {
    const m = await loader();
    return 'default' in (m as object) ? (m as { default: ComponentType<P> }) : { default: m as ComponentType<P> };
  });
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={opts?.loading ? opts.loading() : null}>
        <L {...(props as P & JSX.IntrinsicAttributes)} />
      </Suspense>
    );
  };
}
