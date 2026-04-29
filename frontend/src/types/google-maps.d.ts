interface Window {
  google?: {
    maps?: {
      Map: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
      Marker: new (options: Record<string, unknown>) => unknown;
    };
  };
}
