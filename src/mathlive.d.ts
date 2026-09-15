// <math-field>（MathLive 的自定义元素）在 JSX 里的类型
import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        'math-virtual-keyboard-policy'?: string;
        'smart-fence'?: string;
        'default-mode'?: string;
      };
    }
  }
}
