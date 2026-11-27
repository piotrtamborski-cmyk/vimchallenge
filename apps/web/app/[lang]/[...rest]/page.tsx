import { notFound } from 'next/navigation';

/** Any other address under a language: the language's own "page not found". */
export default function Missing() {
  notFound();
}
