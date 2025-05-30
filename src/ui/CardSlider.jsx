import styled, { keyframes } from 'styled-components';
import Card from '../ui/Card';

const CardSlider = ({ cards, direction, currentIndex, face, isAnimating }) => {
  return (
    <SliderCardWrapper direction={direction}>
      <Card face={face} animating={isAnimating ? false : true}>
        <CardText>{cards.cards[currentIndex][face]}</CardText>
      </Card>
    </SliderCardWrapper>
  );
};

const slideFromLeft = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
`;

const slideFromRight = keyframes`
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
`;

const SliderCardWrapper = styled.div`
  overflow: hidden;

  & > div {
    animation: ${props =>
        props.direction === 'left'
          ? slideFromLeft
          : props.direction === 'right'
          ? slideFromRight
          : 'none'}
      0.5s ease forwards;
  }
`;

const CardText = styled.p`
  font-size: 3rem;
  font-weight: 500;
  line-height: 1.6;
  text-align: center;
  overflow-wrap: normal;
  hyphens: none;
`;

export default CardSlider;
