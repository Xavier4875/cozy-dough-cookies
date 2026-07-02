import './ImagePlaceholder.css';

function ImagePlaceholder({ label = 'Image', className = '', aspectRatio }) {
  const style = aspectRatio ? { aspectRatio } : undefined;
  return (
    <div className={`image-placeholder ${className}`} style={style}>
      <span>{label}</span>
    </div>
  );
}

export default ImagePlaceholder;
