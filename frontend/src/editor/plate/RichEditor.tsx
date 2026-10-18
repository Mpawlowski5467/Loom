/** Placeholder until the Plate editor lands (next commit). */
export function RichEditor(props: {
  noteId: string;
  markdown: string;
  onChange: (md: string) => void;
}) {
  return (
    <pre className="font-mono text-sm whitespace-pre-wrap">
      {props.markdown}
    </pre>
  );
}
