import styled, { css, keyframes } from 'styled-components';

// Animation keyframes
const flipToFront = keyframes`
  from { transform: rotateY(180deg); }
  to { transform: rotateY(0); }
`;

const flipToBack = keyframes`
  from { transform: rotateY(0); }
  to { transform: rotateY(180deg); }
`;

const CardContainer = styled.div`
  background-color: transparent;
  width: clamp(150px, 60vw, 600px);
  height: clamp(90px, 60vh, 320px);
  perspective: 1000px;
`;

const CardInner = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  text-align: center;
  transform-style: preserve-3d;

  /* Conditional animation handling */
  ${props =>
    props.$animating
      ? css`
          transition: transform 0.5s ease-out;
          transform: ${props.$face === 'back'
            ? 'rotateY(180deg)'
            : 'rotateY(0)'};
        `
      : css`
          transform: ${props.$face === 'back'
            ? 'rotateY(180deg)'
            : 'rotateY(0)'};
          animation: ${props => {
            if (!props.$animating) return 'none';
            return props.$face === 'back'
              ? flipToBack + ' 0.5s ease-out forwards'
              : flipToFront + ' 0.5s ease-out forwards';
          }};
        `}
`;

const CardSide = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 4rem 10rem;
  box-shadow: var(--shadow-lg);

  ${props =>
    props.$side === 'front' &&
    css`
      background-color: var(--color-grey-0);
      border: 3px solid var(--color-brand-200);
    `}

  ${props =>
    props.$side === 'back' &&
    css`
      background-color: var(--color-grey-0);
      border: 3px solid var(--color-grey-800);
      transform: rotateY(180deg);
    `}
`;

const Card = ({ children, face = 'front', animating = true }) => {
  return (
    <CardContainer>
      <CardInner $face={face} $animating={animating}>
        <CardSide $side="front">{children}</CardSide>
        <CardSide $side="back">{children}</CardSide>
      </CardInner>
    </CardContainer>
  );
};

export default Card;
