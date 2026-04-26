import type { ReactNode } from 'react';
import styles from './Modal.module.css';

export interface ModalProps {
  title: string;
  children: ReactNode;
}

export function Modal({ title, children }: ModalProps) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog}>
        <div className={styles.title}>{title}</div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

export { styles as modalStyles };
