import { useEffect, useState } from "react";
import { imageBlob } from "./local-store";
export default function ManagedImage({
  user,
  url,
}: {
  user: string;
  url: string;
}) {
  const [src, setSrc] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let alive = true,
      objectURL = "";
    setSrc("");
    setError(false);
    imageBlob(user, url)
      .then((blob) => {
        if (alive) {
          objectURL = URL.createObjectURL(blob);
          setSrc(objectURL);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [user, url]);
  return error ? (
    <span className="missing-image">
      이미지를 다시 연결하세요 / Relink image
    </span>
  ) : src ? (
    <img className="node-image" src={src} alt="" draggable={false} />
  ) : null;
}
