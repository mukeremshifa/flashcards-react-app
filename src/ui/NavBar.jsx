import { NavLink } from 'react-router-dom';
import styled from 'styled-components';

const StyledNavBar = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  justify-content: space-around;
  height: 40px;
`;

const Tab = styled(NavLink)`
  color: #a4a4a4;

  &:hover {
    padding-bottom: 4px;
    border-bottom: 3px solid blueviolet;
  }

  &.active {
    color: #444;
    padding-bottom: 4px;
    border-bottom: 3px solid blueviolet;
  }
`;

function NavBar() {
  return (
    <StyledNavBar>
      <li>LOGO</li>
      <li>Flashcards</li>
      <li>
        <Tab to={'/create'}>Create card</Tab>
      </li>
      <li>
        <Tab to={'/cards'}>Flashcards</Tab>
      </li>
      <li>
        <Tab to={'/card'}>Flashcard</Tab>
      </li>
    </StyledNavBar>
  );
}

export default NavBar;
