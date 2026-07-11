
import React from "react";
import spritesData from "../../content/sprites.json";

export interface Sprite {
  shape: string;
  color: string;
  label: string;
}

export const SPRITES: Record<string, Sprite> = spritesData.sprites as any;

interface SpriteRendererProps {
  spriteId: string;
  className?: string;
  style?: React.CSSProperties;
}

export const SpriteRenderer: React.FC<SpriteRendererProps> = ({ 
  spriteId, 
  className, 
  style 
}) => {
  const sprite = SPRITES[spriteId];
  
  if (!sprite) {
    console.warn(`Sprite not found: ${spriteId}`);
    return null;
  }

  const getShapeStyle = () => {
    switch (sprite.shape) {
      case "square":
        return { width: "48px", height: "48px" };
      case "rectangle":
        return { width: "64px", height: "48px" };
      case "circle":
        return { 
          width: "48px", 
          height: "48px", 
          borderRadius: "50%" 
        };
      case "hexagon":
        return {
          width: "48px",
          height: "56px",
          clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)"
        };
      case "diamond":
        return {
          width: "48px",
          height: "48px",
          transform: "rotate(45deg)"
        };
      case "triangle":
        return {
          width: "0",
          height: "0",
          borderLeft: "24px solid transparent",
          borderRight: "24px solid transparent",
          borderBottom: `48px solid ${sprite.color}`
        };
      case "line":
        return {
          width: "48px",
          height: "4px",
          backgroundColor: sprite.color
        };
      default:
        return { width: "48px", height: "48px" };
    }
  };

  return (
    <div
      className={`sprite ${sprite.shape} ${className || ""}`}
      style={{
        ...style,
        ...getShapeStyle(),
        backgroundColor: sprite.color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "24px"
      }}
    >
      <span>{sprite.label}</span>
    </div>
  );
};

export function getSpriteColor(spriteId: string): string | null {
  const sprite = SPRITES[spriteId];
  return sprite ? sprite.color : null;
}

export function getSpriteEmoji(spriteId: string): string | null {
  const sprite = SPRITES[spriteId];
  return sprite ? sprite.label : null;
}
